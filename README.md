# BurnTestr — interactive demo

**BurnTestr** by team **CTRL + Win** (Team ID **124241**) · Smart India Hackathon · Problem Statement **26170** · ISRO / Department of Space  
(“AI-Driven Anomaly Detection in Component Burn-In & Screening” · Smart Automation · Software).

**Tagline:** Lot-aware burn-in screening that flags components likely to fail later.

Live site: https://mo0001.github.io/burnin-screening-site/

A static site (plain HTML/CSS/ES modules, no build step) presenting locked evaluation results:

- **Home**: the problem, headline results, and how the system works.
- **Explorer**: every part in the held-out test lots, with DPAT band, trajectory vs lot envelope, 168 h forecast, safety-slope check, SHAP contributions, reason codes and QA explanation.
- **Results**: confusion matrices, recall/overkill vs DPAT k, cost vs threshold, forecast MAE and real-data validation, plus honest limitations.
- **Try it**: a simplified Module A (robust DPAT, drift-slope, delta and datasheet checks) that runs entirely in the browser on your own CSV.
- **About**: approach, standards referenced and data attribution.

The ML system itself (Python) is not published here. Source code is available to evaluators on request. This repository contains only exported results on **synthetic** data (`data/*.json`), selected figures and client-side visualisation code.

Real-data validation uses the Iowa State University SMRD2 degradation data (Meeker & Escobar),
CC BY 4.0, DOI [10.25380/iastate.14454765](https://doi.org/10.25380/iastate.14454765). Only aggregate
MAE numbers are shown.

Run locally: `python -m http.server` in this folder, then open http://localhost:8000/.
