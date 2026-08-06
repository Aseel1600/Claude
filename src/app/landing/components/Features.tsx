"use client";
import { useTranslations } from "next-intl";

const FEATURES = [
  {
    icon: "hub",
    titleKey: "featureUnifiedEndpointTitle",
    descKey: "featureUnifiedEndpointDesc",
  },
  {
    icon: "bolt",
    titleKey: "featureEasySetupTitle",
    descKey: "featureEasySetupDesc",
  },
  {
    icon: "auto_awesome",
    titleKey: "featureModelFallbackTitle",
    descKey: "featureModelFallbackDesc",
  },
  {
    icon: "monitoring",
    titleKey: "featureUsageTrackingTitle",
    descKey: "featureUsageTrackingDesc",
  },
  {
    icon: "lock",
    titleKey: "featureOAuthApiKeysTitle",
    descKey: "featureOAuthApiKeysDesc",
  },
  {
    icon: "cloud_sync",
    titleKey: "featureCloudSyncTitle",
    descKey: "featureCloudSyncDesc",
  },
  {
    icon: "terminal",
    titleKey: "featureCliSupportTitle",
    descKey: "featureCliSupportDesc",
  },
  {
    icon: "space_dashboard",
    titleKey: "featureDashboardTitle",
    descKey: "featureDashboardDesc",
  },
];

export default function Features() {
  const t = useTranslations("landing");

  return (
    <section className="py-24 px-6" id="features">
      <div className="max-w-7xl mx-auto">
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("powerfulFeatures")}</h2>
          <p className="text-gray-400 max-w-xl text-lg">{t("featuresSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.titleKey}
              className="p-6 rounded-xl bg-[var(--color-surface)] border border-border hover:border-rose-gold/50 hover:bg-rose-gold/[0.03] transition-all duration-300 group"
            >
              <div className="w-10 h-10 rounded-lg bg-rose-gold/10 flex items-center justify-center mb-4 text-rose-gold group-hover:scale-110 group-hover:bg-rose-gold/15 transition-all duration-300">
                <span className="material-symbols-outlined" aria-hidden="true">
                  {feature.icon}
                </span>
              </div>
              <h3 className="text-lg font-bold mb-2 break-words group-hover:text-rose-gold transition-colors">
                {t(feature.titleKey)}
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed break-words">
                {t(feature.descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
