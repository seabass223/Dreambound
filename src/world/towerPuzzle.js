// The power tower's puzzle. Each catwalk switch box (0 green, 1 yellow, 2 red, as ctx.towerLEDs) has three sliders,
// left to right as you face it, each 'top', 'center' or 'bottom'. Three clues, each three marks on a 3 x 3 grid (the
// column is the slider, the row its position), give the settings:
//   green:  the three discs on the kitchen painting (src/render/painting.js PAINTING_DISCS): middle-left,
//           bottom-middle, top-right.
//   yellow: the three screws on the yellow plate behind the observatory's rear hatch (observatory_design.py
//           build_hatch): top-left, centre, middle-right.
//   red:    the three dots on the red card on the lounge desk (public/models/lounge_card_dots.png, read from the
//           elevator side): top-left, top-right, bottom-middle.
// With every box set and the Tower line powered (the cave generator), the LEDs flash TOWER_SEQUENCE (props/powertower.js),
// and that sequence is the order to press the observatory roof station's buttons in (props/observatoryStation.js).
export const TOWER_SOLUTION = [
  ['center', 'bottom', 'top'],   // green
  ['top', 'center', 'center'],   // yellow
  ['top', 'bottom', 'top'],      // red
];

// LED index by letter (as ctx.towerLEDs and the station's buttons: 0 green, 1 yellow, 2 red).
const LED = { G: 0, Y: 1, R: 2 };
export const TOWER_SEQUENCE = 'RYYRGGGYRRR'.split('').map((c) => LED[c]);
export const SEQ_PULSE = 1;   // seconds per pulse
export const SEQ_REST = 5;    // seconds dark between repeats

export const towerSolved = (state) => TOWER_SOLUTION.every((box, b) => box.every((v, j) => state?.[b]?.[j] === v));
