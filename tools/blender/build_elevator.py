"""Dreambound: the elevator car, its landing doors and frame (design in elevator_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_elevator.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_elevator.py').read())
Env:        ELEV_QUICK=1 bakes small, noisy maps for layout work;
            ELEV_PAINT=1 only repaints the textures from the last build's cached G-buffers (no rebuild, bake or export).
"""
import os
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('elevator', 'elev_', 'Dreambound_Elevator', ao_size=1024, uv_method='smart')
if os.environ.get('ELEV_PAINT') == '1' and bpy.app.background:
    exec(compile(open(DESIGN, encoding='utf-8').read(), DESIGN, 'exec'))
    print('ELEVATOR_RESULT', paint_only())
else:
    result = main(globals())
