"""Meeting minutes from a recording (people meetings, not agent meetings).

audio.py      where recordings live on disk, ffmpeg/ffprobe, the chunk plan
transcript.py stitching chunk transcripts into timestamped paragraphs
writer.py     the prompts, parsing the minutes JSON, the markdown
service.py    the pipeline steps the worker runs, library + tasks + purge
"""
