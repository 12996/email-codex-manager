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

## [ERR-20260714-002] cdp-browser-close-during-inspection

**Logged**: 2026-07-14T23:06:50+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Closing a Playwright browser object connected to the live Roxy CDP endpoint terminated the inspection target.

### Error
```text
browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:11520
```

### Context
- The inspection command connected to the Roxy CDP endpoint to read the current page state.
- It called `browser.close()` after inspection; for a CDP-attached browser this closed the live browser instead of only detaching the inspector.

### Suggested Fix
Use `browser.disconnect()` after read-only CDP inspection. Do not call `browser.close()` unless the browser session itself should be terminated.

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy_2fa_auth_login.js`
- See Also: none

### Resolution
- **Resolved**: 2026-07-14T23:06:50+08:00
- **Notes**: The code verification does not depend on the closed session; future runtime inspection will detach instead of closing.
