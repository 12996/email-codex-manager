# Errors

## [ERR-20260714-001] powershell-inline-node-quoting

**Logged**: 2026-07-14T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
PowerShell passed an escaped quote inside an inline `node --input-type=module -e` script as an unterminated JavaScript string.

### Error
```text
SyntaxError: Invalid or unexpected token
```

### Context
- Attempted to fetch the authenticated `/replacement-ui` HTML and test several `String.includes()` checks in one inline Node command.
- The nested quote around `name="activation_method"` was transformed by PowerShell before Node evaluated it.

### Suggested Fix
Use a request helper with simpler output, avoid nested JavaScript string quotes in PowerShell, or run the check through a temporary script/test instead of a dense inline command.

### Metadata
- Reproducible: yes
- Related Files: `web/index.html`, `web/app.js`
- See Also: none

### Resolution
- **Resolved**: 2026-07-14T00:00:00+08:00
- **Notes**: The application was unaffected; the verification command was rewritten with safer quoting.

