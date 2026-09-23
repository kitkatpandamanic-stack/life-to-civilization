/**
 * Base class for modal panels (inventory, dialogue, shop...).
 *
 * A panel returns HTML from render(). Clicks on elements with
 * data-action="..." are routed to onAction(action, dataset).
 * The UIManager re-renders the open panel when relevant game events fire.
 */
export class Panel {
  constructor(ui) {
    this.ui = ui;
    this.sim = ui.sim;
  }
  /** CSS class suffix and identity. */
  get id() {
    return 'panel';
  }
  title() {
    return '';
  }
  render() {
    return '';
  }
  onAction() {}
  onOpen() {}
  onClose() {}
  /** Number-key shortcuts: return the list of action elements' selectors in order, or null. */
  hotkeys() {
    return null;
  }
}
