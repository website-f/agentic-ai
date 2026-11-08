// Synthetic-browser helper only. Loading is neither a signed-in session nor a persona chooser.
// Wait for an actual UI state instead of reading count() before the demo has bootstrapped.
async function openPersonaChooser(page, switchName) {
  const chooser = page.locator('.persona').first();
  const switchPerson = page.getByRole('button', { name: switchName, exact: true }).first();
  try {
    await chooser.or(switchPerson).first().waitFor({ state: 'visible' });
  } catch (cause) {
    throw new Error(`Persona UI readiness failed: expected a visible persona chooser or the exact "${switchName}" button.`, { cause });
  }
  if (!(await chooser.isVisible())) await switchPerson.click();
  await chooser.waitFor({ state: 'visible' });
}
module.exports = { openPersonaChooser };
