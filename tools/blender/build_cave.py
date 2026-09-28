"""Dreambound: the underground hub, tunnels and generator (design in cave_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_cave.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_cave.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('cave', 'cave_', 'Dreambound_Cave', ao_size=2048, uv_method='smart')
result = main(globals())
