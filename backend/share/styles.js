const RANGES = {
  bold: [0x1d400, 0x1d41a, 0x1d7ce],
  italic: [0x1d434, 0x1d44e, null],
  "bold-italic": [0x1d468, 0x1d482, null],
  script: [0x1d4d0, 0x1d4ea, null],
  double: [0x1d538, 0x1d552, 0x1d7d8],
  sans: [0x1d5a0, 0x1d5ba, 0x1d7e2],
  "sans-bold": [0x1d5d4, 0x1d5ee, 0x1d7ec],
  "sans-italic": [0x1d608, 0x1d622, null],
  "sans-bold-italic": [0x1d63c, 0x1d656, null],
  mono: [0x1d670, 0x1d68a, 0x1d7f6],
};

const EXCEPTIONS = {
  italic: { h: 0x210e },
  double: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
};

const STYLES = ["upper", "lower", ...Object.keys(RANGES)];

function styleChar(char, style) {
  if (style === "upper") return char.toUpperCase();
  if (style === "lower") return char.toLowerCase();
  const range = RANGES[style];
  if (!range || char.length !== 1) return char;
  const exception = EXCEPTIONS[style]?.[char];
  if (exception) return String.fromCodePoint(exception);
  const code = char.charCodeAt(0);
  if (char >= "A" && char <= "Z") return String.fromCodePoint(range[0] + code - 65);
  if (char >= "a" && char <= "z") return String.fromCodePoint(range[1] + code - 97);
  if (char >= "0" && char <= "9" && range[2]) return String.fromCodePoint(range[2] + code - 48);
  return char;
}

module.exports = { STYLES, styleChar };
