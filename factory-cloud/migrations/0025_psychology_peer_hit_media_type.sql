ALTER TABLE psychology_peer_hits ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video', 'photo'));

UPDATE psychology_peer_hits
SET media_type = 'photo'
WHERE video_url LIKE '%/photo/%'
   OR json_extract(video_data_json, '$.mediaType') = 'photo'
   OR json_extract(video_data_json, '$.postType') = 'photo';

CREATE INDEX psychology_peer_hits_media_type_plays
  ON psychology_peer_hits(media_type, play_count DESC, id DESC);
