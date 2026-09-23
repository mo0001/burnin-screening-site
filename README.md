# Burn-in Anomaly Screening: interactive demo

Team **CTRL + Win** · Smart India Hackathon · Problem Statement 26170 · ISRO
("AI-Driven Anomaly Detection in Component Burn-In & Screening").

Live site: https://mo0001.github.io/burnin-screening-site/

A static site (plain HTML/CSS/ES modules, no build step) presenting the results of the project's ML
screening system:

- **Home**: the problem, the headline results and how the system works.
- **Explorer**: every part in the held-out test lots, with the DPAT band, trajectory vs lot envelope,
  168 h forecast, safety-slope check, SHAP contributions, reason codes and QA explanation.
- **Results**: confusion matrices, recall/overkill vs DPAT k, cost vs threshold, forecast MAE and
  real-data validation, plus limitations.
- **Try it**: a simplified Module A (robust DPAT, drift-slope, delta and datasheet checks) that runs
  entirely in the browser on your own CSV.
- **About**: approach, standards referenced and data attribution.

The ML system itself (Python) lives in a private repository. This repository contains only exported
results on **synthetic** data (`data/*.json`), selected figures and client-side visualisation code.

Real-data validation uses the Iowa State University SMRD2 degradation data (Meeker & Escobar),
CC BY 4.0, DOI [10.25380/iastate.14454765](https://doi.org/10.25380/iastate.14454765). Only aggregate
MAE numbers are shown.

Run locally: `python -m http.server` in this folder, then open http://localhost:8000/.
