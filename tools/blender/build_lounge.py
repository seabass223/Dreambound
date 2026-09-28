"""Dreambound: the cartographer's lounge under the Tower's cave station (design in lounge_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_lounge.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_lounge.py').read())
Env:        LOUNGE_REPAINT=1 repaints the map, the card and its dots (kept otherwise, so hand edits survive);
            LOUNGE_QUICK=1 bakes a small, noisy lightmap for layout work.
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('lounge', 'lounge_', 'Dreambound_Lounge', ao_size=2048, uv_method='smart')
result = main(globals())
