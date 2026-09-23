---
name: risk-metrics-calculation
description: Calculate portfolio risk metrics including VaR, CVaR, Sharpe, Sortino, and drawdown analysis. Use when measuring portfolio risk, implementing risk limits, or building risk monitoring systems.
allowed-tools: [Read, Write, Glob, Grep, Edit, Bash]
category: finance
metadata:
  author: wshobson
  version: 1.0.1
  source: https://github.com/wshobson/agents
  lobehub: https://lobehub.com/skills/wshobson-agents-risk-metrics-calculation/skill.md
---

# Risk Metrics Calculation

Comprehensive risk measurement toolkit for portfolio management, including Value at Risk, Expected Shortfall, and drawdown analysis.

## When to Use This Skill

- Measuring portfolio risk
- Implementing risk limits
- Building risk dashboards
- Calculating risk-adjusted returns
- Setting position sizes
- Regulatory reporting

## Core Concepts

### 1. Risk Metric Categories

| Category          | Metrics         | Use Case             |
| ----------------- | --------------- | -------------------- |
| **Volatility**    | Std Dev, Beta   | General risk         |
| **Tail Risk**     | VaR, CVaR       | Extreme losses       |
| **Drawdown**      | Max DD, Calmar  | Capital preservation |
| **Risk-Adjusted** | Sharpe, Sortino | Performance          |

### 2. Time Horizons

Intraday:   Minute/hourly VaR for day traders
Daily:      Standard risk reporting
Weekly:     Rebalancing decisions
Monthly:    Performance attribution
Annual:     Strategic allocation

## Implementation

### Pattern 1: Core Risk Metrics

```python
import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, Optional, Tuple

class RiskMetrics:
    """Core risk metric calculations."""

    def __init__(self, returns: pd.Series, rf_rate: float = 0.02):
        self.returns = returns
        self.rf_rate = rf_rate
        self.ann_factor = 252

    def volatility(self, annualized: bool = True) -> float:
        vol = self.returns.std()
        if annualized:
            vol *= np.sqrt(self.ann_factor)
        return vol

    def var_historical(self, confidence: float = 0.95) -> float:
        return -np.percentile(self.returns, (1 - confidence) * 100)

    def var_parametric(self, confidence: float = 0.95) -> float:
        z_score = stats.norm.ppf(confidence)
        return self.returns.mean() - z_score * self.returns.std()

    def cvar(self, confidence: float = 0.95) -> float:
        var = self.var_historical(confidence)
        return -self.returns[self.returns <= -var].mean()

    def max_drawdown(self) -> float:
        cumulative = (1 + self.returns).cumprod()
        running_max = cumulative.cummax()
        return ((cumulative - running_max) / running_max).min()

    def sharpe_ratio(self) -> float:
        excess_return = self.returns.mean() * self.ann_factor - self.rf_rate
        vol = self.volatility(annualized=True)
        return excess_return / vol if vol > 0 else 0

    def sortino_ratio(self) -> float:
        excess_return = self.returns.mean() * self.ann_factor - self.rf_rate
        downside = self.returns[self.returns < 0].std() * np.sqrt(self.ann_factor)
        return excess_return / downside if downside > 0 else 0

    def calmar_ratio(self) -> float:
        ann_ret = (1 + self.returns).prod() ** (self.ann_factor / len(self.returns)) - 1
        mdd = abs(self.max_drawdown())
        return ann_ret / mdd if mdd > 0 else 0
```

Applied to hydrometeorology: replace financial returns with hydrological residuals (observed - predicted stage) to compute VaR (tail exceedance), drawdown (flood recession), Sharpe analogue (skill per unit error), etc.

### Pattern 2: Portfolio Risk (multi-series)

Use PortfolioRisk to aggregate multiple stations/forecast models (ECMWF vs GFS) as assets, compute diversification, correlation during stress, and conditional correlations.

### Pattern 3: Rolling Risk Metrics

RollingRiskMetrics tracks how MAE, VaR, and Max Drawdown evolve through hydrological seasons; volatility_regime classifies low/normal/high error regimes.

### Pattern 4: Stress Testing

StressTester evaluates forecasts against historical crisis periods (e.g., 2024 flood) analogous to 2008 crisis.

## Best Practices

1. Complement point forecasts with probabilistic intervals (VaR/CVaR)
2. Backtest VaR exceptions; traffic-light zones (0-4 green, 5-9 yellow, 10+ red per 250 forecasts)
3. Use Cornish-Fisher expansion for non-normal hydrological errors (skew/kurtosis)
4. Report CVaR/Expected Shortfall alongside VaR for coherent tail risk
5. Include drawdown duration analysis for flood persistence

## Integration Points for this project

- Apply to Modelo de previsão estatístico simplificado da curva do nível do rio para Campo Bom (iphModel.ts)
- Compute forecast residuals -> VaR 95/99 for stage error, CVaR for tail exceedance, Max Drawdown for flood persistence, NSE/calibration already present
