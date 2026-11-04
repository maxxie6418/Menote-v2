-- 冲突副本关联（G2 §5-2：冲突副本需记录与原条目的关联）。
-- 普通条目为 NULL；冲突副本存原条目的 id，便于人工裁决时回溯。
ALTER TABLE items ADD COLUMN conflict_of TEXT;
