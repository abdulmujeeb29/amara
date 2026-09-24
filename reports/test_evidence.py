from copy import deepcopy
import json
import uuid
from unittest.mock import patch

from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .demo import seed_demo
from .evidence import add_demo_stage, add_report, claim_job, enqueue, new_demo_case, process_job
from .evidence_policy import EvidenceError, decide, validate_analysis
from .models import EvidenceJob, Incident, IncidentUpdate, Preference, UpdateReceipt


def analysis_for(reports, condition="reported"):
    facts=[]
    for report in reports:
        direct=report.source_name in {"Demo observer A", "Demo observer B", "Conflicting demo observer"}
        facts.append({"report_id":report.code,"relevant":True,"stance":"contradicts" if report.source_name=="Conflicting demo observer" else "supports",
            "basis":"firsthand" if direct else "hearsay","origin_group":report.code if direct else "original-cousin",
            "origin_reason":"Independent fictional observation" if direct else "Repeats the cousin's original account",
            "quote":report.original_text,"observed_at":report.observed_at.isoformat() if report.observed_at else None,
            "time_quote":report.original_text if report.observed_at else "","explicit_confirmation":False})
    first=reports[0]
    return {"statements":[{"text":"An obstruction is reported; current conditions remain uncertain.","report_ids":[first.code],"quotes":[{"report_id":first.code,"text":first.original_text}]}],
        "uncertainties":["Independent confirmation is limited."],"condition":condition,"location_name":"","location_quotes":[],"facts":facts,"contradictions":[]}


class EvidenceTests(TestCase):
    @classmethod
    def setUpTestData(cls): seed_demo()

    def setUp(self):
        self.pref=Preference.objects.create(visitor_id=uuid.uuid4())
        self.case=new_demo_case(self.pref)

    def sources(self): return list(self.case.reports.select_related('origin').order_by('ingested_at','pk'))

    def run_job(self,stage='baseline',failure=None):
        queued=enqueue(self.pref.visitor_id,self.case,'demo',{'stage':stage})
        job=claim_job()
        with patch('reports.evidence.analyze', side_effect=failure or (lambda case,reports: validate_analysis(analysis_for(reports,'disputed' if stage=='conflict' else 'reported'),reports))) as model:
            process_job(job)
        queued.refresh_from_db();self.case.refresh_from_db()
        return queued,model

    def test_duplicates_stay_unconfirmed_then_independent_observations_change_status(self):
        baseline,_=self.run_job();self.assertEqual(baseline.status,'succeeded');self.assertEqual(self.case.status,'unconfirmed')
        supported,_=self.run_job('support');self.assertEqual(supported.status,'succeeded');self.assertEqual(self.case.status,'corroborated')
        self.assertEqual(self.case.evidence['decision']['support_count'],2)
        contradicted,_=self.run_job('conflict');self.assertEqual(contradicted.status,'succeeded');self.assertEqual(self.case.status,'unconfirmed')
        self.assertEqual(IncidentUpdate.objects.filter(incident=self.case).count(),3)

    def test_repeated_input_reuses_analysis_without_new_revision_or_model_call(self):
        first,_=self.run_job();revision=self.case.revision
        again,model=self.run_job('reanalyze')
        self.assertTrue(again.result['cached']);self.assertFalse(again.result['changed']);model.assert_not_called()
        self.assertEqual(self.case.revision,revision)

    def test_failed_analysis_retains_previous_briefing(self):
        self.run_job();before=(self.case.summary,self.case.status,self.case.revision)
        add_demo_stage(self.case,'support')
        job,_=self.run_job('reanalyze',EvidenceError('invalid_citation','Quote invalid'))
        self.assertEqual(job.status,'failed');self.assertEqual((self.case.summary,self.case.status,self.case.revision),before)

    def test_fabricated_quotes_and_unknown_ids_are_rejected(self):
        sources=self.sources();data=analysis_for(sources)
        data['statements'][0]['quotes'][0]['text']='This text never appeared in a source.'
        with self.assertRaises(EvidenceError):validate_analysis(data,sources)
        data=analysis_for(sources);data['facts'][0]['report_id']='invented-source'
        with self.assertRaises(EvidenceError):validate_analysis(data,sources)

    def test_publication_time_is_not_observation_time(self):
        sources=self.sources();data=analysis_for(sources)
        data['facts'][0]['observed_at']=sources[0].published_at.isoformat()
        data['facts'][0]['time_quote']=''
        with self.assertRaises(EvidenceError):validate_analysis(data,sources)

    def test_a_model_cannot_promote_known_reposts_to_independent_sources(self):
        sources=self.sources();data=analysis_for(sources)
        for fact in data['facts']:
            fact['basis']='firsthand';fact['origin_group']=fact['report_id']
        result=decide(validate_analysis(data,sources),sources)
        self.assertEqual(result['status'],'unconfirmed');self.assertEqual(result['support_count'],0)

    def test_two_sources_with_unknown_times_do_not_establish_same_current_event(self):
        add_demo_stage(self.case,'support');sources=self.sources();data=analysis_for(sources)
        for source in sources:source.observed_at=None
        for fact in data['facts']:fact['observed_at']=None
        self.assertEqual(decide(validate_analysis(data,sources),sources)['status'],'unconfirmed')

    def test_confirmation_needs_explicit_configured_source(self):
        add_demo_stage(self.case,'support');sources=self.sources();data=analysis_for(sources)
        source=next(r for r in sources if r.source_name=='Demo observer A');source.source_url='https://official.example/report'
        next(f for f in data['facts'] if f['report_id']==source.code)['explicit_confirmation']=True
        self.assertEqual(decide(validate_analysis(deepcopy(data),sources),sources)['status'],'corroborated')
        with override_settings(EVIDENCE_TRUSTED_DOMAINS=('official.example',)):
            self.assertEqual(decide(validate_analysis(deepcopy(data),sources),sources)['confirmation_source'],'official.example')

    def test_safety_assurances_are_not_published(self):
        data=analysis_for(self.sources());data['statements'][0]['text']='The road is safe to travel.'
        with self.assertRaises(EvidenceError):validate_analysis(data,self.sources())

    def test_private_cases_and_job_results_are_isolated(self):
        job,_=self.run_job()
        other=Client()
        self.assertEqual(other.get(f'/api/evidence/jobs/{job.pk}/').status_code,404)
        self.assertEqual(other.get(f'/incidents/{self.case.slug}/').status_code,404)

    def test_one_active_job_per_case(self):
        enqueue(self.pref.visitor_id,self.case,'demo',{'stage':'baseline'})
        with self.assertRaises(EvidenceError):enqueue(self.pref.visitor_id,self.case,'demo',{'stage':'support'})

    def test_empty_public_search_is_unknown_not_a_model_failure_or_safety_claim(self):
        case=Incident.objects.create(slug='empty-search',title='Yaba road question',summary='Pending',uncertainty='Unknown',location_name='Yaba',updated_at=timezone.now(),is_demo=False,case_owner=self.pref.visitor_id)
        queued=enqueue(self.pref.visitor_id,case,'search',{'query':'Yaba road question'})
        job=claim_job()
        with patch('reports.evidence.retrieve_reports',return_value=0),patch('reports.evidence.analyze') as model:
            process_job(job)
        queued.refresh_from_db();case.refresh_from_db()
        self.assertEqual(queued.status,'succeeded');self.assertTrue(queued.result['no_sources']);model.assert_not_called()
        self.assertEqual(case.status,'unconfirmed');self.assertFalse(case.updates.exists())

    def test_two_texts_from_the_same_submitter_are_not_two_independent_origins(self):
        for index in range(2):
            add_report(self.case,name='Submitted demo account',text=f'I observed blocked vehicles at Market Junction on 22 September 2026 at 6:38 PM. Account {index}.',observed_at=timezone.now())
        sources=self.sources();data=analysis_for(sources)
        for fact in data['facts']:
            if next(r for r in sources if r.code==fact['report_id']).source_name=='Submitted demo account':
                fact['basis']='firsthand';fact['origin_group']=fact['report_id']
        result=decide(validate_analysis(data,sources),sources)
        self.assertEqual(result['support_count'],1);self.assertEqual(result['status'],'unconfirmed')


class ReceiptTests(TestCase):
    @classmethod
    def setUpTestData(cls): seed_demo()

    def test_claim_read_dismiss_and_namespace_isolation(self):
        self.client.get('/')
        visitor=self.client.session['visitor_id']
        case=Incident.objects.get(slug='market-junction')
        update=IncidentUpdate.objects.create(incident=case,revision=2,reason='Changed',snapshot={'id':case.slug})
        url=f'/api/updates/{update.pk}/receipt/'
        self.assertTrue(self.client.post(url,json.dumps({'action':'claim'}),content_type='application/json').json()['show'])
        self.assertFalse(self.client.post(url,json.dumps({'action':'claim'}),content_type='application/json').json()['show'])
        self.client.post(url,json.dumps({'action':'read'}),content_type='application/json')
        self.client.post(url,json.dumps({'action':'dismiss'}),content_type='application/json')
        receipt=UpdateReceipt.objects.get(visitor_id=visitor,update=update)
        self.assertIsNotNone(receipt.read_at);self.assertIsNotNone(receipt.dismissed_at)
        browser=Client(enforce_csrf_checks=True)
        self.assertEqual(browser.post(url,json.dumps({'action':'claim'}),content_type='application/json').status_code,403)

    def test_muting_suppresses_popup_claim(self):
        self.client.get('/')
        Preference.objects.create(visitor_id=self.client.session['visitor_id'],muted=True)
        case=Incident.objects.get(slug='market-junction')
        update=IncidentUpdate.objects.create(incident=case,revision=2,reason='Changed',snapshot={'id':case.slug})
        response=self.client.post(f'/api/updates/{update.pk}/receipt/',json.dumps({'action':'claim'}),content_type='application/json')
        self.assertFalse(response.json()['show'])

    def test_job_status_keeps_its_original_summary_after_a_later_revision(self):
        self.client.get('/')
        case=Incident.objects.get(slug='market-junction')
        job=EvidenceJob.objects.create(owner_id=self.client.session['visitor_id'],incident=case,kind='demo',status='succeeded',result={'summary':'Earlier evidence snapshot.','status':'unconfirmed'})
        case.summary='A different, newer briefing.';case.save(update_fields=['summary'])
        result=self.client.get(f'/api/evidence/jobs/{job.pk}/').json()
        self.assertEqual(result['summary'],'Earlier evidence snapshot.')
