export function initializeNfcDeck(root) {
  const buttons = [...root.querySelectorAll('[data-deck-mode]')];
  const panels = [...root.querySelectorAll('[data-deck-panel]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      root.dataset.mode = button.dataset.deckMode;
      for (const option of buttons) option.setAttribute('aria-pressed', String(option === button));
      for (const panel of panels) panel.hidden = panel.dataset.deckPanel !== button.dataset.deckMode;
    });
  }
}
