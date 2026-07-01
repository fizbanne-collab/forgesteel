alter table campaign_document
	add column document_key text;

update campaign_document
set document_key = coalesce(document->>'id', document_type)
where document_key is null;

alter table campaign_document
	alter column document_key set not null;

create unique index campaign_document_key_unique
	on campaign_document(campaign_id, document_type, document_key);
