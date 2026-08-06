import { Anchor, Divider, Group, Modal, Stack, Text } from "@mantine/core";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { arch, version as OSVersion, type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_NAME,
  APP_SITE,
  APP_SITE_URL,
  UPSTREAM_NAME,
  UPSTREAM_SITE,
  UPSTREAM_SITE_URL,
} from "@/utils/appInfo";

function AboutModal({
  opened,
  setOpened,
}: {
  opened: boolean;
  setOpened: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{
    version: string;
    tauri: string;
    os: string;
    architecture: string;
    osVersion: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const os = await type();
      const version = await getVersion();
      const tauri = await getTauriVersion();
      const architecture = await arch();
      const osVersion = await OSVersion();
      setInfo({ version, tauri, os, architecture, osVersion });
    }
    load();
  }, []);
  return (
    <Modal centered opened={opened} onClose={() => setOpened(false)} title={APP_NAME}>
      <Stack gap="xs">
        {/* This is not the program from encroissant.org — it is a separate build
            that updates separately, so it says so before anything else. */}
        <Text size="sm">{t("About.Fork", { app: APP_NAME, original: UPSTREAM_NAME })}</Text>

        <Divider />

        <div>
          <Text>Version: {info?.version}</Text>
          <Text>Tauri version: {info?.tauri}</Text>
          <Text>
            OS: {info?.os} {info?.architecture} {info?.osVersion}
          </Text>
        </div>

        <Divider />

        <Group gap="xs">
          <Anchor href={APP_SITE_URL} target="_blank" rel="noreferrer">
            {APP_SITE}
          </Anchor>
          <Text size="sm" c="dimmed">
            {t("About.ThisBuild")}
          </Text>
        </Group>
        <Group gap="xs">
          <Anchor href={UPSTREAM_SITE_URL} target="_blank" rel="noreferrer">
            {UPSTREAM_SITE}
          </Anchor>
          <Text size="sm" c="dimmed">
            {t("About.Original")}
          </Text>
        </Group>
      </Stack>
    </Modal>
  );
}

export default AboutModal;
