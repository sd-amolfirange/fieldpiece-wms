import { useTranslation } from "react-i18next";

/** "Parts and labour" / "Parts only" / "Labour only" for a part or template line. */
export function useCoverageText() {
  const { t } = useTranslation();
  return (p: { coversParts: boolean; coversLabour: boolean }) =>
    p.coversParts && p.coversLabour
      ? t("parts.partsAndLabour")
      : p.coversLabour
        ? t("parts.labourOnly")
        : t("parts.partsOnly");
}
