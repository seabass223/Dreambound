"""Dreambound: the Mountain shed, the Mountain elevator's upper stop (design in shed_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_shed.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_shed.py').read())
            (then STAGE = 'bake' and STAGE = 'export', or STAGE = 'all')
Env:        SHED_QUICK=1 bakes small, noisy maps for layout work;
            SHED_PAINT=1 only repaints the atlas from the last build's cached G-buffer (no rebuild, bake or export).
"""
import os
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('shed', 'shed_', 'Dreambound_Shed', ao_size=2048, uv_method='smart')
if os.environ.get('SHED_PAINT') == '1' and bpy.app.background:
    exec(compile(open(DESIGN, encoding='utf-8').read(), DESIGN, 'exec'))
    print('SHED_RESULT', paint_only())
else:
    result = main(globals())
