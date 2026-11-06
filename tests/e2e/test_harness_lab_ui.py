from __future__ import annotations

from playwright.sync_api import Browser


def test_operator_workflow_in_real_browser(browser: Browser, live_server: str) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.route(
        "**/*",
        lambda route: route.continue_()
        if route.request.url.startswith(live_server)
        else route.abort("blockedbyclient"),
    )

    page.goto(live_server)
    page.get_by_label("ID", exact=True).fill("support-agent")
    page.get_by_label("Dominio").fill("retail")
    page.get_by_label("Nome").fill("Support Agent")
    page.get_by_role("button", name="Criar agente").click()
    page.get_by_text("Support Agent", exact=True).wait_for()

    page.get_by_role("link", name="Cases").click()
    page.get_by_label("Dominio").fill("retail")
    page.get_by_label("CSV").fill(
        "id,sessionId,similarityGroup,content\n"
        "case-1,session-1,access,Reset access\n"
        "case-2,session-2,billing,Second invoice"
    )
    page.get_by_role("button", name="Importar cases").click()
    page.get_by_text("case-1", exact=True).wait_for()

    page.get_by_role("link", name="Rodadas").click()
    page.get_by_label("ID", exact=True).fill("round-e2e")
    page.get_by_label("Dominio").fill("retail")
    page.get_by_label("Objetivo").fill("Improve support answers")
    page.get_by_role("button", name="Iniciar rodada").click()
    page.get_by_role("heading", name="round-e2e").wait_for()
    assert page.get_by_text("Aguardando o worker.").is_visible()

    context.close()