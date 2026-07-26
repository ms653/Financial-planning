/**
 * Test setup.
 *
 * Only job for now: register `@testing-library/jest-dom`'s matchers (`toBeVisible`,
 * `toBeDisabled`, `toHaveAccessibleName`, …) so component tests can assert on what a user
 * would actually perceive rather than on implementation details. Loaded for every test
 * file including the Node-environment ones; the import is cheap and keeping one setup file
 * is simpler than conditionally loading it.
 */
import '@testing-library/jest-dom/vitest';
