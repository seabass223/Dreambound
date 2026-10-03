"""Dreambound: the gatehouse at the Rocks rim (its blast doors, beacon and lamps) and one section of the staircase that
unfolds from it down to the End stack (design in gatehouse_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_gatehouse.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_gatehouse.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('gatehouse', 'gatehouse_', 'Dreambound_Gatehouse', ao_size=2048, uv_method='smart')
result = main(globals())
