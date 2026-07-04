alter table app_user
	add column username text;

create unique index app_user_username_unique
	on app_user (lower(username))
	where username is not null;

alter table app_user
	add constraint app_user_username_format check (
		username is null or username ~ '^[A-Za-z0-9_]{3,24}$'
	);

alter table campaign
	add column description text;
