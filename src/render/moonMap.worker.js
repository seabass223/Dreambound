// Makes the moon's near-side map off the main thread (render/moon.js moonMap) and hands back its bytes.
import { buildMoonData } from './moonMapGen.js';

self.onmessage = () => {
  const data = buildMoonData();
  self.postMessage(data.buffer, [data.buffer]);
};
