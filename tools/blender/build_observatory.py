"""Dreambound: the Mountain observatory (design in observatory_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_observatory.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_observatory.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('observatory', 'obs_', 'Dreambound_Observatory', ao_size=2048, uv_method='smart')
result = main(globals())
