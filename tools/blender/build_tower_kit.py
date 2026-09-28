"""Dreambound: the power tower's catwalk kit (switch box, sliders, capacitor, solar panel; design in tower_kit_design.py),
built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_tower_kit.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_tower_kit.py').read())
Env:        KIT_QUICK=1 bakes small, noisy maps for layout work;
            KIT_PAINT=1 only repaints the textures from the last build's cached G-buffer (no rebuild, bake or export).
"""
import os
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('tower_kit', 'kit_', 'Dreambound_TowerKit', ao_size=1024, uv_method='smart')
if os.environ.get('KIT_PAINT') == '1' and bpy.app.background:
    exec(compile(open(DESIGN, encoding='utf-8').read(), DESIGN, 'exec'))
    print('TOWER_KIT_RESULT', paint_only())
else:
    result = main(globals())
