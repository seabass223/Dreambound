"""Dreambound: limestone stepping stones for the Home stack's path (design in walkstone_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_walkstones.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_walkstones.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('walkstone', 'walkstone_', 'Dreambound_Walkstones', ao_size=256, uv_method='smart')
result = main(globals())
