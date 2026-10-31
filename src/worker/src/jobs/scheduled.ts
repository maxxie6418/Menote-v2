/** M1 only proves the trigger is wired. M2 will register actual scheduled jobs. */
export function dispatchScheduled(): void {
  // No business tasks, external calls, or database writes in M1.
}
