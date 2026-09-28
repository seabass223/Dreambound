"""Dreambound: the view deck on the Dome stack (platform, two Adirondack chairs, an end table and a lantern; design in
deck_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_deck.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_deck.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('deck', 'deck_', 'Dreambound_Deck', ao_size=1024, uv_method='smart')
result = main(globals())
