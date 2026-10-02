"""Dreambound: the old mine adit's timber and the things left in it (design in mine_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_mine.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_mine.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('mine', 'mine_', 'Dreambound_Mine', ao_size=2048, uv_method='smart')
result = main(globals())
