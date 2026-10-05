# Dreambound

A first-person exploration and puzzle game for the browser: five sea stack islands above the clouds, in the spirit of Myst.

![Dreambound](public/og.webp)

**[Play it](https://dreambound.z13.web.core.windows.net/)** in a desktop browser with a mouse and keyboard.

## Controls

| | |
|---|---|
| **Mouse** | Look |
| **W A S D** | Walk (**Shift** to run) |
| **Space**, **E** or **click** | Use what the centre dot is on |
| **M** | Menu: save, graphics, settings |
| **Esc** | Free the mouse |
| **F7** | Screenshot |

Saving is manual: **Menu > Game > Save**.

## Run it

Needs [Node.js](https://nodejs.org) 20.19 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## More

- Built with [three.js](https://threejs.org), the Web Audio API (every sound is synthesised) and [Blender](https://www.blender.org) scripts (every model is generated).
- [Agent-README.md](Agent-README.md) is the full technical reference, kept for the coding agents that maintain the project. It spoils every puzzle.

## Credits

- **World and puzzle design:** Kyle Sebestyen
- **Concept art:** GPT5.6
- **Programming, 3D modelling, textures, sound and cutscenes:** Opus 5.5, with Blender MCP
