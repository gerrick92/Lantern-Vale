export const palette = {
  ink: "#e9f3e5",
  gold: "#e4c386",
  muted: "#b0c9c0",
  green: "#75cfa8",
  red: "#ee9291",
};
export function text(
  win,
  value,
  x,
  y,
  width,
  size = 22,
  color = palette.ink,
  align = "left",
) {
  win.contents.fontSize = size;
  win.changeTextColor(color);
  win.drawText(String(value), x, y, width, align);
}
export function lines(win, value, x, y, width, size = 20) {
  win.contents.fontSize = size;
  let row = "",
    offset = 0;
  for (const word of String(value).split(" ")) {
    const next = row ? `${row} ${word}` : word;
    if (win.textWidth(next) > width && row) {
      text(win, row, x, y + offset, width, size);
      offset += size + 9;
      row = word;
    } else row = next;
  }
  if (row) text(win, row, x, y + offset, width, size);
  return offset + size + 9;
}
export function panel(scene, x, y, w, h) {
  const win = new Window_Base(new Rectangle(x, y, w, h));
  scene.addWindow(win);
  return win;
}
export class Choices extends Window_Command {
  refresh() {
    const commands = this._list?.slice();
    super.refresh();
    if (commands?.length) {
      this._list = commands;
      this.createContents();
      this.drawAllItems();
    }
  }
}
export function music(name, volume = 38, fade = 0) {
  AudioManager.playBgm({ name, volume, pitch: 100, pan: 0 });
  if (fade > 0) AudioManager.fadeInBgm(fade);
}

export function sound(name) {
  AudioManager.playSe({ name, volume: 65, pitch: 100, pan: 0 });
}
