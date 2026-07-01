create table app_user (
	id uuid primary key default gen_random_uuid(),
	google_subject text unique,
	email text not null,
	display_name text not null,
	avatar_url text,
	site_role text not null default 'player' check (site_role in ('admin', 'player')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index app_user_email_unique on app_user (lower(email));

create table auth_session (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references app_user(id) on delete cascade,
	token_hash text not null unique,
	expires_at timestamptz not null,
	created_at timestamptz not null default now()
);

create table campaign (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	created_by uuid not null references app_user(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table campaign_member (
	campaign_id uuid not null references campaign(id) on delete cascade,
	user_id uuid not null references app_user(id) on delete cascade,
	role text not null check (role in ('director', 'player')),
	joined_at timestamptz not null default now(),
	primary key (campaign_id, user_id)
);

create table invitation (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid references campaign(id) on delete cascade,
	email text,
	token_hash text unique,
	role text not null default 'player' check (role in ('director', 'player')),
	created_by uuid not null references app_user(id),
	expires_at timestamptz,
	accepted_at timestamptz,
	accepted_by uuid references app_user(id),
	created_at timestamptz not null default now(),
	check (email is not null or token_hash is not null)
);

create table character (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid not null references campaign(id) on delete cascade,
	owner_id uuid references app_user(id) on delete set null,
	document jsonb not null,
	revision bigint not null default 1,
	created_by uuid not null references app_user(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index character_campaign_idx on character(campaign_id);
create index character_owner_idx on character(owner_id);

create table character_change (
	id uuid primary key default gen_random_uuid(),
	character_id uuid not null references character(id) on delete cascade,
	revision bigint not null,
	changed_by uuid not null references app_user(id),
	patch jsonb not null,
	snapshot jsonb not null,
	created_at timestamptz not null default now(),
	unique (character_id, revision)
);

create index character_change_history_idx
	on character_change(character_id, revision desc);

create or replace function retain_recent_character_changes()
returns trigger
language plpgsql
as $$
begin
	delete from character_change
	where id in (
		select id
		from character_change
		where character_id = new.character_id
		order by revision desc
		offset 5
	);
	return new;
end;
$$;

create trigger character_change_retention
after insert on character_change
for each row execute function retain_recent_character_changes();

create table campaign_document (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid not null references campaign(id) on delete cascade,
	document_type text not null check (document_type in ('encounter', 'session', 'sourcebook')),
	document jsonb not null,
	revision bigint not null default 1,
	created_by uuid not null references app_user(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index campaign_document_lookup_idx
	on campaign_document(campaign_id, document_type);

create table file_asset (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid not null references campaign(id) on delete cascade,
	uploaded_by uuid not null references app_user(id),
	asset_type text not null check (asset_type in ('portrait', 'handout')),
	storage_key text not null unique,
	content_type text not null,
	original_name text not null,
	byte_size bigint not null check (byte_size >= 0),
	created_at timestamptz not null default now()
);
