# Contributing to PocketLint

Thank you for your interest in contributing to PocketLint! To maintain code quality, ensure licensing compliance, and streamline the integration of new features, please follow these guidelines.

---

## 1. Developer Certificate of Origin (DCO) & Sign-Off

All commits contributed to this project must be signed off to confirm compliance with the Developer Certificate of Origin (DCO). This certifies that you have the right to submit the code under the project's license.

### How to Sign Off
To sign off your work, append the `-s` (or `--signoff`) flag to your git commit command:
```bash
git commit -s -m "feat: your descriptive commit message"
```
This automatically appends your signature to the bottom of the commit message:
```text
Signed-off-by: Jane Doe <jane.doe@example.com>
```

---

## 2. Pull Request Guidelines

To expedite reviews, all Pull Requests (PRs) must meet the following structural and content requirements:

### PR Description Template
Your PR description must include the following sections:

1. **Summary**: A clear, concise explanation of the changes made and the business/technical value they provide.
2. **Type of Change**:
   - `feat` (new feature)
   - `fix` (bug fix)
   - `refactor` (code reorganization without feature additions)
   - `docs` (documentation updates)
   - `chore` (build scripts, dependencies, etc.)
3. **How Has This Been Tested?**: Detailed step-by-step instructions of how you verified the changes (e.g. tested PipeWire routing, verified verification endpoints, etc.).
4. **Impacted Components**: Mention if changes affect the UI, audio loopback routing (`main.js`), database queue, or packaging pipelines.

---

## 3. Testing & Verification

Since PocketLint directly interacts with system audio resources (PipeWire, PulseAudio) and external public APIs, contributors must perform rigorous manual verification before submitting changes:

### Audio Logical Y-Split Verification
* Verify that virtual null sinks (`PocketLoopback` and `PocketRecordMix`) are constructed and torn down cleanly.
* Ensure no microphone input is fed back into physical audio outputs (speakers/headphones) to prevent echo loops.
* Test loopback outputs using the test tone utility to ensure physical output devices are audible.

### API Key and Integration Verification
* Any integration features targeting the Pocket APIs must be verified using non-destructive endpoints.
* Never hardcode API keys or upload mock data to production databases.

### Distributable Packaging Verification
* If modifying the packaging configuration, compile and verify the generated RPM package locally:
  ```bash
  npm run dist
  ```
* Verify the package dependencies and binary permissions:
  ```bash
  rpm -qp -R dist/pocketlint-1.0.0-1.x86_64.rpm
  ```
  Ensure permissions on the `chrome-sandbox` are set to `4755`.

---

## 4. Code Style & Standards

* **Javascript Style**: Write clean, standard ES6 JavaScript. Avoid unnecessary complexity.
* **Documentation**: Update [README.md](README.md) and related files if command line scripts or configuration structures are modified. Maintain docstrings and comments on complex PipeWire subprocess commands.
