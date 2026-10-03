"""Dreambound: the ending's alarm clock (a black pill-shaped bedside clock with blue seven-segment LEDs; design in
alarmclock_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_alarmclock.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_alarmclock.py').read())
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('alarmclock', 'clock_', 'Dreambound_AlarmClock', ao_size=256, uv_method='smart')
result = main(globals())
