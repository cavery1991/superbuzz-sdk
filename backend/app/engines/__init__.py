"""
SuperBuzz PPC Analytics - Analysis Engines

This package contains the core analytical engines for the eCommerce PPC
decision-support system:

- classification: Brand vs non-brand search term classification
- incrementality: Multi-level incrementality analysis
- causation: Correlation vs causation analysis
- patterns: Contextual pattern memory and state-based decisions
- insights: Automated insight generation
- recommendations: Actionable recommendation engine
- simulator: Scenario simulation engine
"""

from app.engines.classification import (
    classify_term,
    classify_all_terms,
    get_coverage_stats,
)
from app.engines.incrementality import (
    observational_analysis,
    proxy_incrementality,
    calculate_experiment_results,
)
from app.engines.causation import (
    analyze_correlation,
    check_temporal_precedence,
    check_isolation,
    check_saturation,
    check_demand_dependency,
    full_causal_analysis,
)
from app.engines.patterns import (
    build_state,
    calculate_similarity,
    find_similar_states,
    summarize_similar_outcomes,
    generate_pattern_insights,
)
from app.engines.insights import generate_insights
from app.engines.recommendations import generate_recommendations
from app.engines.simulator import simulate_scenario

__all__ = [
    # Classification
    "classify_term",
    "classify_all_terms",
    "get_coverage_stats",
    # Incrementality
    "observational_analysis",
    "proxy_incrementality",
    "calculate_experiment_results",
    # Causation
    "analyze_correlation",
    "check_temporal_precedence",
    "check_isolation",
    "check_saturation",
    "check_demand_dependency",
    "full_causal_analysis",
    # Patterns
    "build_state",
    "calculate_similarity",
    "find_similar_states",
    "summarize_similar_outcomes",
    "generate_pattern_insights",
    # Insights
    "generate_insights",
    # Recommendations
    "generate_recommendations",
    # Simulator
    "simulate_scenario",
]
