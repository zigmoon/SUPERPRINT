# IDML Regression Fixtures

`styled-reflow` covers a two-frame `ParentStory` with explicit `NextTextFrame`, rich character styles, tracking, underline, and enough text to require reflow.

Build an archive for manual import:

```powershell
.\build-fixture.ps1
```

Run the browser regression when Playwright is available:

```powershell
npx playwright test tests/idml/import-regression.spec.js
```

The test verifies that the story is not duplicated, all frames are linked, and character-level styles survive the import.