# Code Reviewer — Patterns & Checks

This file contains all the patterns to check during every code review cycle. These are real bugs that have happened before or common pitfalls. Actively look for every single one of these during the 3 review rounds.

---

## 1. String Casing Mismatches

**Severity:** Medium | **Found in:** PR review

If one function uses case-insensitive comparison (e.g. `toLowerCase()`, `toUpperCase()`, `localeCompare()`), ALL related functions that look up or match the same data must use the same casing approach.

**Bad:**
```js
// Function A: case-insensitive
const exists = contacts.some(c => c.email.toLowerCase() === input.toLowerCase());
// Function B: strict — WILL SILENTLY FAIL when casing differs
const contact = contacts.find(c => c.email === input);
```

**Good:**
```js
// Both use the same approach
const exists = contacts.some(c => c.email.toLowerCase() === input.toLowerCase());
const contact = contacts.find(c => c.email.toLowerCase() === input.toLowerCase());
```

**Check:** Any time you see `toLowerCase()`, `toUpperCase()`, or `localeCompare()`, search for all other places that compare the same field and verify consistency.

---

## 2. Null/Undefined Access

**Severity:** High

Accessing properties on values that could be null or undefined. Especially common after `.find()`, API responses, and optional parameters.

**Check:**
- Every `.find()` result must be null-checked before accessing properties
- API response bodies must be validated before use
- Optional chaining (`?.`) or explicit checks where data might be missing
- Destructuring from potentially null objects

---

## 3. Race Conditions in Async Code

**Severity:** High

Multiple async operations that read/write the same data without proper sequencing.

**Check:**
- State updates after async calls — is the state still valid when the response arrives?
- Multiple concurrent writes to the same resource
- Missing `await` on async functions (fire-and-forget bugs)
- `useEffect` cleanup — does the component handle unmounting during an async call?

---

## 4. Off-by-One Errors in Array/String Operations

**Severity:** Medium

Incorrect index boundaries in loops, slicing, substring operations.

**Check:**
- `< length` vs `<= length`
- `.slice()` and `.substring()` end indices (exclusive vs inclusive)
- Pagination offsets (0-based vs 1-based)
- Empty array/string edge cases

---

## 5. Unhandled Promise Rejections

**Severity:** High

Async functions that can throw but have no try/catch or `.catch()`.

**Check:**
- Every `await` call that hits an external service (API, database) should be wrapped in try/catch
- `.then()` chains should have a `.catch()`
- Error responses from fetch/axios — checking `response.ok` or status codes

---

## 6. SQL/NoSQL Injection

**Severity:** Critical

User input interpolated directly into queries.

**Check:**
- String concatenation or template literals in database queries
- Use parameterized queries / prepared statements instead
- ORM methods that accept raw input — verify they're sanitized

---

## 7. XSS (Cross-Site Scripting)

**Severity:** Critical

User-supplied content rendered as HTML without sanitization.

**Check:**
- `dangerouslySetInnerHTML` in React — is the input sanitized?
- `[innerHTML]` in Angular — is the input sanitized?
- URL parameters rendered on page
- User-generated content (names, bios, comments) displayed without escaping
- `href` attributes with user input (javascript: protocol)

---

## 8. Missing Loading/Error States in UI

**Severity:** Medium

UI components that fetch data but don't handle loading or error scenarios.

**Check:**
- Every data fetch should have: loading state, error state, empty state, success state
- Buttons that trigger async actions should show loading and disable during the request
- Forms should handle submission errors gracefully with user-visible feedback

---

## 9. Memory Leaks

**Severity:** Medium

Event listeners, intervals, or subscriptions that aren't cleaned up.

**Check:**
- `addEventListener` without corresponding `removeEventListener`
- `setInterval` / `setTimeout` without cleanup on unmount
- Subscriptions (WebSocket, event emitters, RxJS) without unsubscribe
- React `useEffect` missing cleanup return function
- Angular `ngOnDestroy` missing unsubscribe calls

---

## 10. Stale Closures in React

**Severity:** Medium

Callbacks that capture outdated state/props values.

**Check:**
- `useEffect` / `useCallback` / `useMemo` with missing dependencies
- Event handlers inside `useEffect` that reference state but don't include it in deps
- setTimeout/setInterval callbacks that reference state

---

## 11. Hardcoded Values That Should Be Config

**Severity:** Low

Magic numbers, URLs, secrets, or environment-specific values in code.

**Check:**
- API URLs hardcoded instead of using env vars
- Secrets or API keys in source code
- Magic numbers without named constants
- Environment-specific logic (localhost, staging URLs) in production code

---

## 12. Inconsistent Error Handling

**Severity:** Medium

Some code paths handle errors while similar paths don't, or errors are silently swallowed.

**Check:**
- `catch` blocks that are empty or just `console.log`
- Some API calls wrapped in try/catch while similar ones aren't
- Error messages that don't help the user understand what went wrong
- Errors caught but not propagated when they should be

---

## 13. Missing Input Validation

**Severity:** High

User input accepted without validation at the boundary.

**Check:**
- Form inputs — are required fields validated? Are formats checked (email, URL, phone)?
- API endpoint parameters — are types, ranges, and formats validated?
- File uploads — are size limits and file types checked?
- Numeric inputs — are min/max/NaN handled?

---

## 14. Timezone and Date Handling

**Severity:** Medium

Dates displayed or compared without considering timezone.

**Check:**
- Dates stored in UTC but displayed without converting to local time
- Date comparisons using string comparison instead of proper date objects
- `new Date()` usage that assumes local timezone when UTC is needed
- Date formatting that doesn't account for locale

---

## 15. N+1 Query Problems

**Severity:** Medium

Database queries inside loops instead of batch fetching.

**Check:**
- Loops that make a DB query per iteration
- Rendering lists where each item triggers a separate fetch
- Missing `include` / `populate` / `JOIN` for related data

---

## 16. Broken Auth/Permission Checks

**Severity:** Critical

Endpoints or UI actions that don't verify the user has permission.

**Check:**
- API endpoints that don't check authentication
- Actions that don't verify the user owns the resource they're modifying
- Admin-only features accessible without role check
- Client-side only permission checks (must also be on server)

---

## 17. Unintended Data Exposure

**Severity:** High

API responses that return more data than the client needs.

**Check:**
- API returning full user objects including password hashes, tokens, or internal IDs
- Error messages that leak stack traces or internal paths
- Debug/verbose logging that exposes sensitive data

---

## 18. Incorrect Boolean Logic

**Severity:** Medium

Wrong use of `&&`, `||`, `!`, or truthy/falsy checks.

**Check:**
- `if (value)` when `value` could be `0`, `""`, or `false` (all falsy but valid)
- Inverted conditions (should be `!==` but uses `===`)
- Complex conditions without parentheses — operator precedence bugs
- `||` used for defaults when `??` (nullish coalescing) is more correct

---

## 19. Mutating Shared Object References

**Severity:** Medium | **Found in:** PR review

Modifying objects in place (e.g. in `.map()`, `.forEach()`, or `ngOnInit`) when those objects are shared references. If the user cancels or the operation is aborted, the original data is already corrupted.

**Bad:**
```js
// Mutates the original objects — if user cancels, data is already changed
const recipients = data.card.cc.map(r => {
  r.country = normalizeCountry(r.country); // MUTATES original object
  return r;
});
```

**Good:**
```js
// Creates new objects — original data is untouched
const recipients = data.card.cc.map(r => ({
  ...r,
  country: normalizeCountry(r.country),
}));
```

**Check:**
- `.map()` callbacks that assign to the original object instead of returning a new one
- `.forEach()` that modifies properties on input objects
- Any data transformation in dialogs, modals, or forms — always clone before mutating
- Initialization code (`ngOnInit`, `useEffect`, constructors) that transforms shared data in place
- Ask: "If the user cancels this action, is the original data still clean?"

---

## 20. Dead Code — Unused Constants, Functions, and Imports

**Severity:** Low | **Found in:** PR review

Module-level constants, helper functions, or imports that are never referenced. Often happens when code is refactored — the class gets its own version of a value but the old module-level one is left behind.

**Bad:**
```ts
// Module level — never used
const priceTags = ['free', 'paid', 'premium'];
function rangeToTag(range) { return range; } // dead code

class FilterComponent {
  priceTags = ['free', 'paid', 'premium']; // this is the one actually used
}
```

**Good:**
```ts
// Only the instance property exists — no dead code
class FilterComponent {
  priceTags = ['free', 'paid', 'premium'];
}
```

**Check:**
- After making changes, search the file for any constants, functions, or imports that are no longer referenced
- Module-level declarations that are shadowed by class/component instance properties
- Helper functions that were used by removed code
- Imports at the top of the file that nothing uses anymore
- Don't introduce new dead code, and clean up any you create during the task

---

## 21. Test/Debug Scripts Committed to Repo

**Severity:** Low | **Found in:** PR review

Manual testing scripts, debug helpers, or throwaway Puppeteer/Playwright scripts that Claude created during development get committed to the repo. These have hardcoded localhost URLs, local file paths, `headless: false`, and are not part of the actual test suite.

**Common offenders:**
- `test-*.js` or `test-*.ts` files in the repo root or random directories
- Puppeteer/Playwright scripts with hardcoded `localhost` URLs
- Scripts that write screenshots to local paths
- One-off validation scripts created during a task

**Check:**
- Before committing, run `git status` and review every new file — ask: "Is this file part of the feature, or was it created for debugging/testing?"
- Any file with `headless: false`, hardcoded `localhost` URLs, or local screenshot paths is almost certainly a temp file
- Delete these before raising the PR
- This overlaps with the "Clean Up Temp Files" rule in CODE-AGENT.md — both apply

---

_Add new patterns here as they are discovered. Each entry should include: severity, description, what to check, and ideally a bad/good code example._
