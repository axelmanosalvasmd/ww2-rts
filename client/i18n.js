// English is the available language. Keep the translation hook usable by the HUD.
export const t = text => text;

const language = document.getElementById('langSel');
if (language) {
  const english = document.createElement('option');
  english.value = 'en';
  english.textContent = 'English';
  language.replaceChildren(english);
}
