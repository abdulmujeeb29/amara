from django import forms
import math

from .models import Preference


class JourneyForm(forms.Form):
    destination = forms.CharField(max_length=180, required=False, strip=True)
    mode = forms.ChoiceField(choices=Preference._meta.get_field("travel_mode").choices, initial="driving")
    step = forms.ChoiceField(choices=[("setup", "Setup"), ("review", "Review")], initial="setup")


class PlaceSearchForm(forms.Form):
    q = forms.CharField(min_length=3, max_length=160, strip=True)


class RouteForm(forms.Form):
    demo_route = forms.BooleanField(required=False)
    origin_lng = forms.FloatField(min_value=-180, max_value=180)
    origin_lat = forms.FloatField(min_value=-90, max_value=90)
    destination_lng = forms.FloatField(min_value=-180, max_value=180)
    destination_lat = forms.FloatField(min_value=-90, max_value=90)
    mode = forms.ChoiceField(choices=[("walking", "Walking"), ("driving", "Driving")])

    def clean(self):
        cleaned = super().clean()
        for name in ("origin_lng", "origin_lat", "destination_lng", "destination_lat"):
            if name in cleaned and not math.isfinite(cleaned[name]):
                self.add_error(name, "Choose a valid map coordinate.")
        return cleaned


class PreferenceForm(forms.ModelForm):
    class Meta:
        model = Preference
        fields = ["follow_market_road", "follow_yaba_area", "muted", "travel_mode"]
