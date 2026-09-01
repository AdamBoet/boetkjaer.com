-- Optional merchant/person name shown alongside a transaction's category
-- (e.g. "Groceries" + merchant "Netto Emdrupvej", or "Hygge" + merchant
-- "Jacob Strandqvist"). Kept separate from `description` since that field
-- doubles as the category key for the spending-by-category chart and the
-- edit dropdown's selected value — appending a name into it would fragment
-- the chart and break editing those rows.

alter table economy_transactions add column if not exists merchant text;
