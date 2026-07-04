alter table campaign
	add column is_personal boolean not null default false;

create unique index campaign_personal_owner_unique
	on campaign(created_by)
	where is_personal;

with personal_campaigns as (
	insert into campaign (name, description, created_by, is_personal)
	select
		'__personal__' || id::text,
		'Private character workspace',
		id,
		true
	from app_user
	returning id, created_by
)
insert into campaign_member (campaign_id, user_id, role)
select id, created_by, 'director'
from personal_campaigns;
