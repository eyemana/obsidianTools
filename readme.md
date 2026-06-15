To batch process scenes, for example: 

'''
    node .\evaluators\batch-evaluate-scenes.mjs "C:\\obsidian\\POC\\Scenes" 
'''

To process an individual scene:

'''
    node .\evaluators\evaluate-scene-tension.mjs "c:\\obsidian\\POC\\Scenes\\01 Inventory Day.md"
'''

These require metadata, or frontmatter, including characters.  See the following example.

NOTE: the "ai" section of json below will be created in the scene frontmatter when these scripts are run.

---
name: Inventory Day
type: Scene
chapter: 1
pov: Mara Bell
characters:
  - Mara Bell
  - Theo Vale
  - Evelyn Pike
threads:
  - Missing Ledger
story_engines:
  - The Founders Secret
timeline_order: 1
reader_knowledge: None
tension: 6
ai:
  model: 'qwen2.5:7b'
  tension:
    scene: 7
    updated: '2026-06-15T19:51:49.020Z'
    characters:
      Mara Bell: 8
      Theo Vale: 2
      Evelyn Pike: 3
---