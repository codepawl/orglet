import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
// Registers `toHaveNoViolations` and its type.
import 'vitest-axe/extend-expect';

// Testing Library unmounts on its own only when the runner exposes a global `afterEach`, and this one does not.
afterEach(() => {
  cleanup();
});
