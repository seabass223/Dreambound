"""Dreambound: the cabin and its geodesic dome (design in cabin_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_cabin.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_cabin.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('cabin', 'cabin_', 'Dreambound_Cabin', ao_size=2048)
result = main(globals())
