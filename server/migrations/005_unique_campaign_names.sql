with duplicate_names as (
	select
		id,
		row_number() over (
			partition by lower(name)
			order by created_at, id
		) as duplicate_number
	from campaign
)
update campaign
set name = campaign.name || ' (' || left(campaign.id::text, 8) || ')',
	updated_at = now()
from duplicate_names
where campaign.id = duplicate_names.id
	and duplicate_names.duplicate_number > 1;

create unique index campaign_name_unique
	on campaign (lower(name));
