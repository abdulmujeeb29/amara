from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from .models import PreparedDemo
from .replay import prepare_demo


class SavedReplayTests(TestCase):
    def make_pack(self,key='saved-v1',active=True):
        source={'id':'saved-r1','source_name':'Fictional witness','original_text':'Original fictional account.','relationship':'Demo source'}
        incident={'id':'replay-roadworks','title':'Example report','status':'corroborated','status_label':'Corroborated','uncertainty':'Current conditions remain uncertain.','coordinates':[3.37,6.51]}
        event={'key':'roadworks','incoming_source_ids':['saved-r1'],'received_text':'An account arrived.','result':{'incident':incident,'sources':[source],'model':'recorded-model','prepared_at':timezone.now().isoformat(),'analysis':{'statements':[{'text':'Saved AI interpretation.','report_ids':['saved-r1']}]}}}
        return PreparedDemo.objects.create(key=key,active=active,model_name='recorded-model',payload={'mode':'demo_replay','events':[event],'routes':{'walking':{},'driving':{}}})

    @patch('reports.replay.analyze')
    @patch('reports.replay.calculate_route')
    def test_playback_reads_saved_data_without_provider_calls(self,route,analyze):
        pack=self.make_pack()
        response=self.client.get('/api/demo/scenario/')
        self.assertEqual(response.status_code,200);self.assertEqual(response.json(),pack.payload)
        route.assert_not_called();analyze.assert_not_called()

    @patch('reports.replay.analyze')
    @patch('reports.replay.calculate_route')
    def test_preparation_reuses_an_existing_pack(self,route,analyze):
        pack=self.make_pack();saved,created=prepare_demo()
        self.assertFalse(created);self.assertEqual(saved.pk,pack.pk)
        route.assert_not_called();analyze.assert_not_called()

    def test_missing_pack_does_not_launch_live_analysis(self):
        response=self.client.get('/api/demo/scenario/')
        self.assertEqual(response.status_code,503);self.assertEqual(response.json()['code'],'demo_not_prepared')

    def test_received_and_checking_views_do_not_show_the_review_result(self):
        self.make_pack()
        for state in ['received','checking']:
            response=self.client.get('/demo/evidence/saved-v1/roadworks/',{'state':state})
            self.assertContains(response,'Original fictional account.')
            self.assertNotContains(response,'Saved AI interpretation.')
        self.assertContains(self.client.get('/demo/evidence/saved-v1/roadworks/'),'Saved AI interpretation.')

    def test_old_replay_links_keep_their_frozen_evidence_after_new_version(self):
        self.make_pack(active=False);self.make_pack(key='saved-v2')
        self.assertContains(self.client.get('/demo/evidence/saved-v1/roadworks/'),'Saved AI interpretation.')
        self.assertEqual(self.client.get('/demo/evidence/saved-v1/missing/').status_code,404)
