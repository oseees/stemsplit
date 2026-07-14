"""Pydantic models for the API surface, plus the JSON schema we ask Claude to fill.

The response schema mirrors PoultryPal's required output format:
SUMMARY / LIKELY DISEASES / REASONING / IMMEDIATE ACTIONS / TREATMENT PLAN /
DRUGS / PREVENTION / WHEN TO CALL A VET.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class FarmInfo(BaseModel):
    species: str = Field(..., description="e.g. chicken (layer/broiler), duck, turkey")
    state: Optional[str] = Field(None, description="Nigerian state, for nearest-lab ranking")
    breed: Optional[str] = None
    age: Optional[str] = Field(None, description="e.g. '6 weeks', '1.5 years'")
    flock_size: Optional[int] = None
    sick_count: Optional[int] = None
    dead_count: Optional[int] = None
    days_since_onset: Optional[int] = None
    vaccination_history: Optional[str] = None
    symptoms: str = Field(..., description="Free-text description of what the farmer sees")
    recent_changes: Optional[str] = Field(
        None, description="New birds, feed/water changes, weather, relocation, etc."
    )


# ---- Structured diagnosis result (also used as the JSON schema for Claude) ----

class LikelyDisease(BaseModel):
    name: str
    confidence_percent: int = Field(..., ge=0, le=100)
    reasoning: str


class Drug(BaseModel):
    name: str
    note: str = Field(..., description="What it's for / how it's used — from the source only")
    source: str = Field(..., description="Citation: which knowledge source this came from")


class FeedbackIn(BaseModel):
    case_id: str
    confirmed_disease: Optional[str] = ""
    treatment_used: Optional[str] = ""
    outcome: Optional[str] = ""  # recovered | died | ongoing | not_sure
    helpful: Optional[bool] = None
    notes: Optional[str] = ""


class RecommendedTest(BaseModel):
    test: str = Field(..., description="The confirmatory lab/clinical test to request")
    reason: str = Field(..., description="Which suspected disease it confirms and why it helps")


class Lab(BaseModel):
    name: str
    location: str
    services: str
    contact: str
    note: str


class VetAdvice(BaseModel):
    recommended: bool
    urgency: Literal["routine", "soon", "urgent"]
    reason: str


class SourceRef(BaseModel):
    title: str
    ref: str


class DiagnosisResult(BaseModel):
    summary: str
    likely_diseases: list[LikelyDisease]
    immediate_actions: list[str]
    isolation: str
    treatment_plan: list[str]
    drugs: list[Drug]
    recommended_tests: list[RecommendedTest]
    prevention: list[str]
    call_vet: VetAdvice
    disclaimer: str
    sources_used: list[SourceRef]
    image_findings: Optional[str] = None
    # Attached by the server from the curated Nigeria directory (never LLM-generated).
    labs: list[Lab] = []


# ---- Production optimizer (broiler weight gain / layer egg production) ----

class PerformanceRequest(BaseModel):
    bird_type: Literal["broiler", "layer"]
    state: Optional[str] = Field(None, description="Nigerian state (context only)")
    breed: Optional[str] = None
    age: Optional[str] = Field(None, description="e.g. '4 weeks' (broiler), '30 weeks' (layer)")
    flock_size: Optional[int] = None
    current_metric: Optional[str] = Field(
        None, description="broiler: current average weight; layer: current % hen-day or eggs/day"
    )
    target: Optional[str] = Field(None, description="the farmer's goal, e.g. '2.2 kg by 6 weeks'")
    feed: Optional[str] = Field(None, description="feed brand/type currently used")
    feeding_practice: Optional[str] = Field(None, description="how much / how often they feed")
    lighting: Optional[str] = Field(None, description="light hours/day (layers)")
    challenges: Optional[str] = Field(None, description="heat, feed cost, recent illness, etc.")
    notes: Optional[str] = None


class TargetItem(BaseModel):
    label: str
    value: str


class PlanPhase(BaseModel):
    phase: str
    detail: str


class WeeklyStep(BaseModel):
    period: str
    actions: str


class PerformancePlan(BaseModel):
    summary: str
    current_assessment: str
    targets: list[TargetItem]
    gaps: list[str]
    feeding_plan: list[PlanPhase]
    management_actions: list[str]
    health_checks: list[str]
    weekly_plan: list[WeeklyStep]
    expected_outcome: str
    cautions: list[str]
    disclaimer: str = ""
    sources_used: list[SourceRef] = []


PERFORMANCE_JSON_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "current_assessment": {"type": "string"},
        "targets": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "string"},
                },
                "required": ["label", "value"],
            },
        },
        "gaps": {"type": "array", "items": {"type": "string"}},
        "feeding_plan": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "phase": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["phase", "detail"],
            },
        },
        "management_actions": {"type": "array", "items": {"type": "string"}},
        "health_checks": {"type": "array", "items": {"type": "string"}},
        "weekly_plan": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "period": {"type": "string"},
                    "actions": {"type": "string"},
                },
                "required": ["period", "actions"],
            },
        },
        "expected_outcome": {"type": "string"},
        "cautions": {"type": "array", "items": {"type": "string"}},
        "sources_used": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "ref": {"type": "string"},
                },
                "required": ["title", "ref"],
            },
        },
    },
    "required": [
        "summary",
        "current_assessment",
        "targets",
        "gaps",
        "feeding_plan",
        "management_actions",
        "health_checks",
        "weekly_plan",
        "expected_outcome",
        "cautions",
        "sources_used",
    ],
}


# JSON schema handed to Claude via output_config.format. Kept in sync with
# DiagnosisResult but hand-written so it respects structured-output constraints
# (every object has additionalProperties:false; no min/max-length strings).
DIAGNOSIS_JSON_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "likely_diseases": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "confidence_percent": {"type": "integer"},
                    "reasoning": {"type": "string"},
                },
                "required": ["name", "confidence_percent", "reasoning"],
            },
        },
        "immediate_actions": {"type": "array", "items": {"type": "string"}},
        "isolation": {"type": "string"},
        "treatment_plan": {"type": "array", "items": {"type": "string"}},
        "drugs": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "note": {"type": "string"},
                    "source": {"type": "string"},
                },
                "required": ["name", "note", "source"],
            },
        },
        "recommended_tests": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "test": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["test", "reason"],
            },
        },
        "prevention": {"type": "array", "items": {"type": "string"}},
        "call_vet": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "recommended": {"type": "boolean"},
                "urgency": {"type": "string", "enum": ["routine", "soon", "urgent"]},
                "reason": {"type": "string"},
            },
            "required": ["recommended", "urgency", "reason"],
        },
        "disclaimer": {"type": "string"},
        "sources_used": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "ref": {"type": "string"},
                },
                "required": ["title", "ref"],
            },
        },
    },
    "required": [
        "summary",
        "likely_diseases",
        "immediate_actions",
        "isolation",
        "treatment_plan",
        "drugs",
        "recommended_tests",
        "prevention",
        "call_vet",
        "disclaimer",
        "sources_used",
    ],
}
