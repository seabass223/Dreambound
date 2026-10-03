"""Dreambound: the End stack's pedestal (its bezel, shaft, column and red button) and the light shafts out of the
aperture (design in endprops_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_endprops.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_endprops.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('endprops', 'endp_', 'Dreambound_EndProps', ao_size=1024, uv_method='smart')
result = main(globals())
