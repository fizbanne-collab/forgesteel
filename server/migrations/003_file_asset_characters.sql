alter table file_asset
	add column character_id uuid references character(id) on delete cascade;

alter table file_asset
	add constraint file_asset_character_type_check check (
		(asset_type = 'portrait' and character_id is not null)
		or (asset_type = 'handout' and character_id is null)
	);

create unique index file_asset_character_portrait_unique
	on file_asset(character_id)
	where asset_type = 'portrait';
