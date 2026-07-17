export function isBuildAndRunShortcut(event) {
  return !!event &&
    event.key === "Enter" &&
    (event.ctrlKey === true || event.metaKey === true) &&
    event.altKey !== true &&
    event.shiftKey !== true;
}

export class BuildRunIntent {
  constructor() {
    this._seq = null;
  }

  arm(seq) {
    this._seq = seq;
  }

  cancel() {
    this._seq = null;
  }

  consume(seq) {
    if (this._seq === null || seq !== this._seq) return false;
    this._seq = null;
    return true;
  }
}
